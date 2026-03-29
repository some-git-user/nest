import fs from 'fs';

export type InsecureFileReason = 'owner-mismatch' | 'group-or-other-writable';

export type FileSecurityValidationResult =
	| {ok: true}
	| {
			ok: false;
			reason: InsecureFileReason;
			expectedUid: number;
			actualUid: number;
	  };

export const validateUnixFileSecurity = (
	fileStat: fs.Stats,
	expectedUid: number,
): FileSecurityValidationResult => {
	if (fileStat.uid !== expectedUid) {
		return {
			ok: false,
			reason: 'owner-mismatch',
			expectedUid,
			actualUid: fileStat.uid,
		};
	}

	const isGroupWritable = (fileStat.mode & 0o020) !== 0;
	const isOtherWritable = (fileStat.mode & 0o002) !== 0;
	if (isGroupWritable || isOtherWritable) {
		return {
			ok: false,
			reason: 'group-or-other-writable',
			expectedUid,
			actualUid: fileStat.uid,
		};
	}

	return {ok: true};
};
