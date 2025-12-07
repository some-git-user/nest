export const checkTest = (params: {
  nagiosReturnMessage: string;
  nagiosReturnValue: 0 | 1 | 2 | 3;
  performanceData: boolean;
}) => {
  const { nagiosReturnMessage, nagiosReturnValue, performanceData } = params;
  console.log(
    `Testplugin received: nagiosReturnMessage=${nagiosReturnMessage}, nagiosRetunValue=${nagiosReturnValue}, performanceData=${performanceData}`
  );

  const returnObject = {
    message: nagiosReturnMessage,
    code: nagiosReturnValue,
    performanceData: [{}],
  };

  if (!nagiosReturnMessage || !nagiosReturnValue) {
    returnObject.message = `Usage: /check-test?nagiosReturnMessage=<string>&nagiosRetunValue=<0 | 1 | 2 | 3>&performanceData=<true | false>`;
    returnObject.code = 3;
  }

  if (performanceData) {
    const label = "label";
    const value = "value";
    const uom = "uom";
    const warn = "warn";
    const crit = "crit";
    const min = "min";
    const max = "max";
    returnObject.performanceData.push({
      label,
      value,
      uom,
      warn,
      crit,
      min,
      max,
    });
  }

  console.log(`Testplugin will return: ${JSON.stringify(returnObject)}`);
  return returnObject;
};
