import { createNagiosReturnMessage } from "@/lib/nagios";
import express, { Request, Response } from "express";
import fs from "fs";
import path from "path";
import ts from "typescript";

const router = express.Router();

const pluginsDir = path.join(process.cwd(), "plugins");

fs.readdirSync(pluginsDir)?.forEach((file) => {
  const filePath = path.join(pluginsDir, file);
  const jsFilePath = filePath.replace(/\.ts$/, ".js");

  const tsCode = fs.readFileSync(filePath, "utf-8");
  const result = ts.transpileModule(tsCode, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ESNext,
      esModuleInterop: true,
      allowSyntheticDefaultImports: true,
      outDir: path.dirname(jsFilePath),
    },
  });

  fs.writeFileSync(jsFilePath, result.outputText);

  const fileStat = fs.statSync(filePath);

  if (fileStat.isFile() && filePath.endsWith(".ts")) {
    const kebabCasePath = `/${path
      .basename(file, path.extname(file))
      .replace(/[^a-zA-Z0-9]/g, "-")
      .toLowerCase()}`;
    console.info(
      `GET route initialized for plugin: ${filePath}: http://${process.env.HOST}:${process.env.PORT}${kebabCasePath}`
    );

    router.get(kebabCasePath, (req: Request, res: Response) => {
      import(`${jsFilePath}?t=${Date.now()}`)
        .then((module) => {
          const func =
            typeof module.default === "function"
              ? module.default
              : module.checkTest ||
                (module.default && module.default.checkTest) ||
                (() => {
                  throw new Error("Function not found");
                });
          if (typeof func === "function") {
            console.debug(req.url);

            const urlParams = req.url
              .split(/\?|&/)
              .filter((param) => param !== "")
              .map(decodeURIComponent);
            const paramsObj: { [key: string]: string } = {};

            urlParams.forEach((param) => {
              const [key, value] = param.split(/=/);
              paramsObj[key] = value;
            });

            const result = func(paramsObj);

            if (result instanceof Promise) {
              result
                .then((data) => res.send(data))
                .catch((err) => res.status(500).send(err));
            } else {
              const { message, code, performanceData } = result ?? {};
              const validNagiosReturnValues = [0, 1, 2, 3];
              const codeString = code?.toString() ?? "";
              const codeNumber = Number.parseInt(codeString, 10);
              const isValidCode = validNagiosReturnValues.includes(codeNumber);
              console.debug(message, code, performanceData);

              if (isValidCode && typeof message === "string") {
                const nagiosReturn = createNagiosReturnMessage(
                  message,
                  code,
                  performanceData
                );
                console.debug(nagiosReturn);

                return res.send(nagiosReturn);
              } else {
                return res.send("Error: Invalid response format");
              }
            }
          } else {
            console.error("Plugin must export a function");
            res.status(500).send("Plugin must export a function");
          }
        })
        .catch((err) => {
          console.error(err);
          res
            .status(500)
            .send(`Error loading plugin: ${jsFilePath}. Error: ${err}`);
        });
    });
  }
});

export default router;
