import "i18next";
import type { en } from "./locales/en";

// Keys are checked against the English text: `t("no.such.key")` does not compile.
declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "translation";
    returnNull: false;
    resources: { translation: typeof en };
  }
}
