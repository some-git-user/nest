import { config } from 'dotenv';
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
} from 'envalid';

config();

const nonEmptyStrValidator = makeValidator<string>((input: string) => {
    const trimmedInput = input.trim();
    if (trimmedInput !== '') {
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
            const inputArray = input.split(/,\s*/).filter(str => str !== ''); // Use regex for splitting and filtering empty strings
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
    NODE_ENV: str({ devDefault: 'development' }),
    PORT: port({ default: 5000 }),
    FRONTEND_URL: url({ devDefault: 'http://localhost:3000' }),
    COOKIE_DOMAIN: str({ devDefault: 'localhost' }),

    FTP_ROOT: nonEmptyStrValidator(),
    FTP_PORT: nonEmptyStrValidator(),
    FTP_MAX_UPLOAD_SIZE: nonEmptyStrValidator(),

    JWT_SECRET: nonEmptyStrValidator(),
    JWT_EXPIRE: nonEmptyStrValidator(),
    JWT_COOKIE_EXPIRE: num(),

    MONGO_URI: url(),

    SMTP_HOST: host(),
    SMTP_PORT: port(),
    SMTP_USERNAME: nonEmptyStrValidator(),
    SMTP_PASSWORD: nonEmptyStrValidator(),
    FROM_EMAIL: email(),
    FROM_NAME: nonEmptyStrValidator(),
});