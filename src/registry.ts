import { ADHOC_PROFILE_NAME } from "./adhoc.ts";
import { RequestError, type Profile } from "./types.ts";

export const RESERVED_PROFILE_NAMES: ReadonlySet<string> = new Set([ADHOC_PROFILE_NAME]);

export interface ProfileRegistry {
	get(name: string): Profile | undefined;
	has(name: string): boolean;
	list(): Profile[];
}

export function createRegistry(profiles: Profile[]): ProfileRegistry {
	const byName = new Map<string, Profile>();
	for (const profile of profiles) {
		if (profile.name.trim().length === 0) {
			throw new RequestError("Profile names must not be empty.", 400, "invalid_profile", "name");
		}
		if (RESERVED_PROFILE_NAMES.has(profile.name)) {
			throw new RequestError(`Profile name "${profile.name}" is reserved.`, 400, "invalid_profile", "name");
		}
		if (byName.has(profile.name)) {
			throw new RequestError(`Duplicate profile name "${profile.name}".`, 400, "invalid_profile", "name");
		}
		byName.set(profile.name, profile);
	}
	return {
		get: (name) => byName.get(name),
		has: (name) => byName.has(name),
		list: () => [...byName.values()],
	};
}
