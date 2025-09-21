import {
  ZodTypeAny,
  ZodString,
  ZodNumber,
  ZodBoolean,
  ZodLiteral,
  ZodEnum,
  ZodArray,
  ZodObject,
  ZodOptional,
  ZodDefault,
  ZodUnion,
  ZodRecord,
  ZodAny,
  ZodUnknown,
  ZodNullable,
  ZodLiteralUnion,
} from '../zod/index';

export interface ZodToJsonSchemaOptions {
  name?: string;
}

interface ConvertedSchema {
  schema: Record<string, unknown>;
  required: boolean;
}

function mergeNullability(schema: Record<string, unknown>): Record<string, unknown> {
  if (!schema.type) {
    return schema;
  }
  if (Array.isArray(schema.type)) {
    if (!schema.type.includes('null')) {
      return { ...schema, type: [...schema.type, 'null'] };
    }
    return schema;
  }
  return { ...schema, type: [schema.type, 'null'] };
}

function convert(schema: ZodTypeAny): ConvertedSchema {
  if (schema instanceof ZodOptional) {
    const inner = convert(schema.unwrap());
    return { schema: inner.schema, required: false };
  }
  if (schema instanceof ZodDefault) {
    const inner = convert(schema.unwrap());
    const defaultValue = schema.parse(undefined);
    return {
      schema: { ...inner.schema, default: defaultValue },
      required: false,
    };
  }
  if (schema instanceof ZodNullable) {
    const inner = convert(schema.unwrap());
    return { schema: mergeNullability(inner.schema), required: inner.required };
  }
  if (schema instanceof ZodString) {
    return { schema: { type: 'string' }, required: true };
  }
  if (schema instanceof ZodNumber) {
    return { schema: { type: 'number' }, required: true };
  }
  if (schema instanceof ZodBoolean) {
    return { schema: { type: 'boolean' }, required: true };
  }
  if (schema instanceof ZodLiteral) {
    const literal = schema.literal;
    const type = typeof literal;
    return {
      schema: { type, enum: [literal] },
      required: true,
    };
  }
  if (schema instanceof ZodEnum) {
    return {
      schema: { type: 'string', enum: schema.optionsArray.slice() },
      required: true,
    };
  }
  if (schema instanceof ZodLiteralUnion) {
    return {
      schema: { enum: schema.values.slice() },
      required: true,
    };
  }
  if (schema instanceof ZodArray) {
    const element = convert(schema.unwrap());
    return {
      schema: { type: 'array', items: element.schema },
      required: true,
    };
  }
  if (schema instanceof ZodRecord) {
    const valueSchema = convert(schema.unwrap());
    return {
      schema: { type: 'object', additionalProperties: valueSchema.schema },
      required: true,
    };
  }
  if (schema instanceof ZodUnion) {
    const anyOf = schema.optionsList.map((option) => convert(option).schema);
    return {
      schema: { anyOf },
      required: true,
    };
  }
  if (schema instanceof ZodObject) {
    const shape = schema.shapeKeys();
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const key of Object.keys(shape)) {
      const converted = convert(shape[key]);
      properties[key] = converted.schema;
      if (converted.required) {
        required.push(key);
      }
    }
    const objectSchema: Record<string, unknown> = {
      type: 'object',
      properties,
    };
    if (required.length) {
      objectSchema.required = required;
    }
    return { schema: objectSchema, required: true };
  }
  if (schema instanceof ZodAny || schema instanceof ZodUnknown) {
    return { schema: {}, required: true };
  }
  return { schema: {}, required: true };
}

export default function zodToJsonSchema(
  schema: ZodTypeAny,
  options: ZodToJsonSchemaOptions = {},
): Record<string, unknown> {
  const converted = convert(schema);
  const result = { ...converted.schema };
  if (options.name) {
    (result as any).title = options.name;
  }
  return result;
}
