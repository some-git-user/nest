import { config } from "dotenv";
import {
  cleanEnv,
  email,
  EnvError,
  host,
  makeValidator,
  num,
  port,
  str,
  url,
} from "envalid";

config();

const nonEmptyStrValidator = makeValidator<string>((input: string) => {
  const trimmedInput = input.trim();
  if (trimmedInput !== "") {
    return trimmedInput;
  } else {
    throw new EnvError(`Not a non-empty string: "${input}"`);
  }
});

const nonEmptyStr = nonEmptyStrValidator();

export const strList = makeValidator<Array<string>>((input: string) => {
  const validateList = (input: string | Array<string>): Array<string> => {
    if (Array.isArray(input)) {
      return input.map(nonEmptyStr._parse);
    } else {
      const inputArray = input.split(/,\s*/).filter((str) => str !== ""); // Use regex for splitting and filtering empty strings
      return validateList(inputArray);
    }
  };

  try {
    return validateList(input);
  } catch {
    throw new EnvError(`Not a (list of) valid string(s): "${input}"`);
  }
});

export const env = cleanEnv(process.env, {
  NODE_ENV: str({ devDefault: "development" }),
  HOST: host(),
  PORT: port({ default: 5000 }),
});
