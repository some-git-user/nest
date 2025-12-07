import fs from "fs";

type endoflifeResponseType = {
  result: {
    label: "Debian";
    name: "debian";
    releases: [
      {
        codename: string;
        eoesFrom: string;
        eolFrom: string;
        isEoes: boolean;
        isEol: boolean;
        isLts: boolean;
        isMaintained: boolean;
        label: string;
        latest: {
          date: string;
          name: string;
        };
        ltsFrom: string;
        name: string;
        releaseDate: string;
      }
    ];
  };
};

export const checkDebianEol = async (params: {
  warningEolRemainingDays: number;
  criticalEolRemainingDays: number;
}) => {
  const { warningEolRemainingDays = 60, criticalEolRemainingDays = 30 } =
    params;
  const returnObject = {
    message: "Should not be here",
    code: 3,
  };
  const debianVersionFile = "/etc/os-release";
  const debianVersion = await fs.promises
    .readFile(debianVersionFile, "utf-8")
    .then((data) => {
      const versionIdMatch = data.match(/VERSION_ID="?([^"]+)"/);
      if (versionIdMatch) {
        return versionIdMatch[1];
      } else {
        throw new Error("VERSION_ID not found in /etc/os-release");
      }
    })
    .catch((error) => {
      console.error(`Error reading debian version file: ${error}`);
      return null;
    });

  const eolUrl = "https://endoflife.date/api/v1/products/debian/";
  const response = await fetch(eolUrl);
  if (!response.ok) {
    returnObject.message = `Error: ${response.status} ${response.statusText}`;
    return returnObject;
  }
  const jsonResponse: endoflifeResponseType = await response.json();

  if (
    jsonResponse?.result?.releases &&
    Array.isArray(jsonResponse.result.releases) &&
    jsonResponse.result.releases.length > 0
  ) {
    const latestMatchingRelease = jsonResponse.result.releases.find(
      (release) => release.name === debianVersion
    );
    console.log(latestMatchingRelease);

    if (!latestMatchingRelease) {
      returnObject.message = `Debian version "${debianVersion}" does not match any releases from ${eolUrl}`;
      return returnObject;
    }
    if (latestMatchingRelease.isEol) {
      returnObject.message = `Debian version "${debianVersion}" is EOL since ${latestMatchingRelease.eolFrom}`;
      returnObject.code = 2;
    }
    const eolDate = new Date(latestMatchingRelease.eolFrom);
    const today = new Date();
    const daysRemaining = Math.ceil(
      (eolDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
    );

    if (daysRemaining <= criticalEolRemainingDays) {
      returnObject.message = `Debian version "${debianVersion}" is EOL in ${daysRemaining} days`;
      returnObject.code = 2; // CRITICAL
      console.log(returnObject);
    } else if (daysRemaining <= warningEolRemainingDays) {
      returnObject.message = `Debian version "${debianVersion}" is EOL in ${daysRemaining} days`;
      returnObject.code = 1; // WARNING
      console.log(returnObject);
    } else if (daysRemaining > warningEolRemainingDays) {
      returnObject.message = `Debian version "${debianVersion}" is not EOL. Remaining days: ${daysRemaining}`;
      returnObject.code = 0; // OK
      console.log(returnObject);
    }
  }

  console.log(returnObject);

  return returnObject;
};
