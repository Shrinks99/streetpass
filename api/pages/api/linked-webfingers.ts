import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { Webfinger, WebfingerSchema } from "../../util";
import * as cheerio from "cheerio";

const QuerySchema = z.object({
  url: z.string(),
});

type LinkedWebfinger = { webfinger: Webfinger; url: string };
export type LinkedWebfingers = Array<LinkedWebfinger>;

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  try {
    const queryUrl = new URL(QuerySchema.parse({ url: req.query.url }).url);
    const queryUrlHtml = await (await fetch(queryUrl)).text();

    const $ = cheerio.load(queryUrlHtml);
    const hrefsUnchecked = $("link[rel=me], a[rel=me]")
      .toArray()
      .map((el): string | null | undefined => {
        return el.attribs.href;
      });

    const unfilteredLinkedWebfingers = await Promise.allSettled(
      hrefsUnchecked.map(
        async (hrefUnchecked): Promise<LinkedWebfinger | null> => {
          if (!hrefUnchecked) {
            return null;
          }

          const href = new URL(hrefUnchecked);
          const webfingerUrl = new URL(href.origin);
          webfingerUrl.pathname = ".well-known/webfinger";
          webfingerUrl.searchParams.set("resource", href.toString());
          const webfingerResp = await fetch(webfingerUrl.toString());
          const unparsedWebfingerJson = await webfingerResp.json();
          const webfinger = WebfingerSchema.parse(unparsedWebfingerJson);

          return { webfinger, url: href.toString() };
        }
      )
    );
    const linkedWebfingers: LinkedWebfingers = [];
    for (const linkedWebfinger of unfilteredLinkedWebfingers) {
      if (linkedWebfinger.status === "fulfilled" && !!linkedWebfinger.value) {
        linkedWebfingers.push(linkedWebfinger.value);
      }
    }

    const cacheTimeSeconds = 60 * 60 * 12; // 12 hours
    const swrCacheTimeSeconds = 60 * 60 * 24 * 31; // 31 days is the max cache time https://vercel.com/docs/concepts/edge-network/caching
    res.setHeader(
      "cache-control",
      `public, s-maxage=${cacheTimeSeconds}, stale-while-revalidate=${swrCacheTimeSeconds}, must-revalidate, max-age=0`
    );
    res.status(200).json(linkedWebfingers);
    res.end();
    return;
  } catch (err) {
    res.status(500);
    res.end();
    return;
  }
}