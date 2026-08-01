/** JSON-safe values accepted by the connector Capture transport contract. */
export type JsonPrimitive = boolean | number | string | null

export type JsonValue = JsonPrimitive | JsonValue[] | {
  [key: string]: JsonValue
}

export interface JsonObject {
  [key: string]: JsonValue
}
