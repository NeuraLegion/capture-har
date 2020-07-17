import {CoreOptions, OptionsWithUrl, Request, RequestAPI, RequiredUriUrl} from "request";
import {Har} from "har-format";

declare interface HarOptions {
  withContent?: boolean;
  maxContentLength?: number;
}

declare function captureHar(requestConfig: OptionsWithUrl, harConfig: HarOptions): Har;

declare namespace captureHar {
  class CaptureHar {
    constructor(request: RequestAPI<Request, CoreOptions, RequiredUriUrl>);

    start(requestConfig: OptionsWithUrl, harConfig?: HarOptions, depth?: number): Har;

    stop(): Har;
  }
}

export = captureHar;
