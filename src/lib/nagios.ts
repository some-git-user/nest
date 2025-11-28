import {
  NagiosReturnMessage,
  nagiosReturnValuesEnum,
  PerformanceData,
} from "@/@types/nagios";

export const createNagiosReturnMessage = (
  message: string,
  code: nagiosReturnValuesEnum,
  performanceData?: PerformanceData | PerformanceData[]
): NagiosReturnMessage => {
  const nagiosReturnMessage: NagiosReturnMessage = {
    message,
    code,
  };

  if (performanceData) {
    console.debug(performanceData);
    if (!Array.isArray(performanceData)) {
      performanceData = [performanceData];
    }

    if (performanceData.every((perfData) => perfData)) {
      nagiosReturnMessage.performanceData = performanceData
        .flatMap(
          (perfData) =>
            `${perfData.label ? `'${perfData.label}':` : ""}${
              perfData.value
                ? `${perfData.value}${perfData.uom ? `${perfData.uom}` : ""}`
                : ""
            }${perfData.warn ? `;WARN=${perfData.warn}` : ""}${
              perfData.crit ? `;CRIT=${perfData.crit}` : ""
            }${perfData.min ? `;MIN=${perfData.min}` : ""}${
              perfData.max ? `;MAX=${perfData.max}` : ""
            }`
        )
        .join(" ")
        .trimStart();
    } else {
      console.error(`Error parsing performance data: ${performanceData}`);
    }
  }

  return nagiosReturnMessage;
};
