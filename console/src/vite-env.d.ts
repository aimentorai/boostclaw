/// <reference types="vite/client" />
/* eslint-disable @typescript-eslint/no-unused-vars */


declare module "*.less" {
  const classes: { [key: string]: string };
  export default classes;
}

declare global {
  interface PyWebViewAPI {
    open_external_link: (url: string) => void;
    get_auth_state: () => Promise<string>;
    set_auth_state: (state_json: string) => Promise<boolean>;
    clear_auth_state: () => Promise<boolean>;
  }

  interface Window {
    pywebview?: {
      api: PyWebViewAPI;
    };
  }
}

export {};
