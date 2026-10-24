type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);

const allowNull = (schema: Json): Json => {
  if (Array.isArray(schema.anyOf)) return { ...schema, anyOf: [...schema.anyOf, { type: "null" }] };
  return { anyOf: [schema, { type: "null" }] };
};

/** Rewrites a JSON Schema for OpenAI strict function tools: no extra properties, every property required, optional ones nullable. */
export function toStrictSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(toStrictSchema);
  if (!isObject(schema)) return schema;
  const rest = Object.fromEntries(Object.entries(schema).filter(([key]) => key !== "$schema"));
  const result: Json = Object.fromEntries(Object.entries(rest).map(([key, value]) => [key, key === "properties" ? value : toStrictSchema(value)]));
  if (isObject(rest.properties)) {
    const required = new Set(Array.isArray(rest.required) ? (rest.required as string[]) : []);
    result.properties = Object.fromEntries(Object.entries(rest.properties).map(([name, property]) => {
      const strict = toStrictSchema(property) as Json;
      return [name, required.has(name) ? strict : allowNull(strict)];
    }));
    result.required = Object.keys(rest.properties);
    result.additionalProperties = false;
  }
  return result;
}

/** Undoes the nullable rewrite: drops the null values the model sent for properties the original schema did not require. */
export function dropNullOptionals(value: unknown, original: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => dropNullOptionals(item, isObject(original) ? original.items : undefined));
  if (!isObject(value) || !isObject(original) || !isObject(original.properties)) return value;
  const required = new Set(Array.isArray(original.required) ? (original.required as string[]) : []);
  const properties = original.properties;
  return Object.fromEntries(Object.entries(value)
    .filter(([name, item]) => !(item === null && properties[name] !== undefined && !required.has(name)))
    .map(([name, item]) => [name, dropNullOptionals(item, properties[name])]));
}
