import { z } from "zod";
import {
  Message,
  MessageReturn,
  Profile,
  timeToExpireNotProfile,
  timeToUpdateProfile,
} from "./constants";
import { getUncachedProfileData } from "./getUncachedProfileData";
import { getHrefStore } from "./storage";

type ArgMap = {
  [Key in Message["name"]]: Extract<Message, { name: Key }>["args"];
};

export const messageCallbacks: {
  [K in keyof ArgMap]: (value: ArgMap[K]) => z.infer<(typeof MessageReturn)[K]>;
} = {
  async HREF_PAYLOAD(args) {
    const hasExistingHrefData = (
      await getHrefStore((prev) => {
        const hrefStore = new Map(prev);
        for (const [key, hrefData] of hrefStore) {
          if (
            hrefData.profileData.type === "notProfile" &&
            hrefData.viewedAt + timeToExpireNotProfile < Date.now()
          ) {
            hrefStore.delete(key);
          }
        }

        return hrefStore;
      })
    ).has(args.relMeHref);

    if (hasExistingHrefData) {
      return;
    }

    const profileData = await getUncachedProfileData(args.relMeHref);

    console.log({ profileData });

    await getHrefStore((hrefStore) => {
      const newHrefStore = new Map(hrefStore);
      newHrefStore.set(args.relMeHref, {
        profileData: profileData,
        viewedAt: Date.now(),
        websiteUrl: args.tabUrl,
        relMeHref: args.relMeHref,
      });

      return newHrefStore;
    });
  },
  /**
   * Update a profile with uncached data. Returns true if updated.
   * Will not add a new profile, only update an existing one.
   */
  async FETCH_PROFILE_UPDATE(args) {
    console.log("FETCH_PROFILE_UPDATE");

    /**
     * Exit if relMeHref isn't a valid url
     */
    try {
      new URL(args.relMeHref);
    } catch (err) {
      return false;
    }

    let hasUpdated = false;
    await getHrefStore(async (hrefStore) => {
      /**
       * Exit if not profile type
       */
      const existingHrefData = hrefStore.get(args.relMeHref);
      if (existingHrefData?.profileData.type !== "profile") {
        console.log("not profile type");
        return;
      }

      /**
       * Exit if has been updated recently
       */
      {
        const lastDate =
          existingHrefData.updatedAt ?? existingHrefData.viewedAt;
        if (lastDate + timeToUpdateProfile > Date.now()) {
          console.log("has been updated recently", args.relMeHref);
          return;
        }
      }

      let profileData: Profile | undefined;
      try {
        /**
         * Exit if fetched profileData is notProfile
         */
        const _profileData = await getUncachedProfileData(args.relMeHref);
        if (_profileData.type === "notProfile") {
          console.log("fetched profileData is notProfile");
          throw new Error();
        }

        /**
         * Exit if all keys are equal
         */
        {
          const existingProfileData = existingHrefData.profileData;
          if (
            Profile.keyof().options.every(
              (key) => existingProfileData[key] === _profileData[key],
            )
          ) {
            console.log("all keys are equal");
            throw new Error();
          }
        }

        profileData = _profileData;
      } catch (err) {
        // Do nothing
      }

      hasUpdated = !!profileData;
      console.log({ hasUpdated, profileData });
      return new Map(hrefStore).set(args.relMeHref, {
        ...existingHrefData,
        updatedAt: Date.now(),
        profileData: profileData ?? existingHrefData.profileData,
      });
    });

    return hasUpdated;
  },
};

/**
 * Thanks to https://stackoverflow.com/questions/70598583/argument-of-type-string-number-is-not-assignable-to-parameter-of-type-never
 * And https://github.com/Microsoft/TypeScript/issues/30581#issuecomment-1008338350
 * todo look at https://github.com/Microsoft/TypeScript/issues/30581#issuecomment-1080979994
 */
export function runMessageCallback<K extends keyof ArgMap>(
  message: { [P in K]: { name: P; args: ArgMap[P] } }[K],
): z.infer<(typeof MessageReturn)[K]> {
  return messageCallbacks[message.name](message.args);
}
