import { ValedictorianProtocolError, ValedictorianTransportError, } from '@sparxie/sdk';
import { createFailClosedRequestError, } from './valedictorian-cli.endpoint-errors.js';
export async function requestValedictorianJson({ apiBaseUrl, apiToken, path, body, method = 'GET', errorSurface, }) {
    const url = new URL(path, apiBaseUrl);
    const headers = {
        accept: 'application/json',
    };
    if (apiToken) {
        headers.authorization = `Bearer ${apiToken}`;
    }
    const init = {
        headers,
        method,
    };
    if (body !== undefined) {
        headers['content-type'] = 'application/json';
        init.body = JSON.stringify(body);
    }
    let response;
    try {
        response = await fetch(url.toString(), init);
    }
    catch (error) {
        throw new ValedictorianTransportError({ cause: error });
    }
    const responseBody = await readResponseBody(response);
    if (!response.ok) {
        throw createFailClosedRequestError(response.status, responseBody, errorSurface);
    }
    return responseBody;
}
async function readResponseBody(response) {
    let text;
    try {
        text = await response.text();
    }
    catch (error) {
        throw new ValedictorianTransportError({ cause: error });
    }
    if (!text)
        return undefined;
    try {
        return JSON.parse(text);
    }
    catch (error) {
        throw new ValedictorianProtocolError({ cause: error });
    }
}
export { createFailClosedRequestError };
