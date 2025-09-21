/* Minimal Zod subset implemented for offline environments.
 * Supports the APIs required by the Scenario Configurator.
 */
export type ZodPath = Array<string | number>;

export interface ZodIssue {
  path: ZodPath;
  code: string;
  message: string;
}

export class ZodError extends Error {
  issues: ZodIssue[];

  constructor(issues: ZodIssue[]) {
    super(
      issues
        .map((issue) =>
          issue.path.length ? `${issue.path.join('.')}: ${issue.message}` : issue.message,
        )
        .join('\n') || 'Zod validation error',
    );
    this.issues = issues;
    this.name = 'ZodError';
  }
}

interface ParseContext {
  issues: ZodIssue[];
}

export interface RefinementCtx {
  addIssue(issue: { path?: ZodPath; message: string; code?: string }): void;
}

export type SafeParseSuccess<T> = { success: true; data: T };
export type SafeParseFailure = { success: false; error: ZodError };
export type SafeParseReturnType<T> = SafeParseSuccess<T> | SafeParseFailure;

export abstract class ZodType<T> {
  /**
   * Placeholder used for `z.infer` compatibility.
   */
  readonly _type!: T;

  protected refinements: Array<(value: T, ctx: RefinementCtx) => void> = [];

  parse(input: unknown): T {
    const result = this.safeParse(input);
    if (!result.success) {
      throw result.error;
    }
    return result.data;
  }

  safeParse(input: unknown): SafeParseReturnType<T> {
    const ctx: ParseContext = { issues: [] };
    const value = this._parse(input, ctx, []);
    if (ctx.issues.length > 0) {
      return { success: false, error: new ZodError(ctx.issues) };
    }
    return { success: true, data: value };
  }

  protected abstract _parse(input: unknown, ctx: ParseContext, path: ZodPath): T;

  protected runRefinements(value: T, ctx: ParseContext, path: ZodPath) {
    if (!this.refinements.length) {
      return;
    }
    const refinementCtx: RefinementCtx = {
      addIssue: (issue) =>
        ctx.issues.push({
          path: issue.path ?? path,
          message: issue.message,
          code: issue.code ?? 'custom',
        }),
    };
    for (const ref of this.refinements) {
      ref(value, refinementCtx);
    }
  }

  optional(): ZodOptional<T> {
    return new ZodOptional(this);
  }

  nullable(): ZodNullable<T> {
    return new ZodNullable(this);
  }

  default(def: T | (() => T)): ZodDefault<T> {
    return new ZodDefault(this, def);
  }

  describe(_description: string): this {
    return this;
  }

  refine(check: (value: T) => boolean, message = 'Invalid value'): this {
    this.refinements.push((value, ctx) => {
      if (!check(value)) {
        ctx.addIssue({ message });
      }
    });
    return this;
  }

  superRefine(check: (value: T, ctx: RefinementCtx) => void): this {
    this.refinements.push(check);
    return this;
  }
}

export class ZodString extends ZodType<string> {
  private minLength?: { value: number; message: string };
  private maxLength?: { value: number; message: string };

  protected _parse(input: unknown, ctx: ParseContext, path: ZodPath): string {
    if (typeof input !== 'string') {
      ctx.issues.push({ path, code: 'invalid_type', message: 'Expected string' });
      return '';
    }
    if (this.minLength && input.length < this.minLength.value) {
      ctx.issues.push({ path, code: 'too_small', message: this.minLength.message });
    }
    if (this.maxLength && input.length > this.maxLength.value) {
      ctx.issues.push({ path, code: 'too_big', message: this.maxLength.message });
    }
    this.runRefinements(input, ctx, path);
    return input;
  }

  min(value: number, message?: string) {
    this.minLength = { value, message: message ?? `Should be at least ${value} characters` };
    return this;
  }

  max(value: number, message?: string) {
    this.maxLength = { value, message: message ?? `Should be at most ${value} characters` };
    return this;
  }

  nonempty(message = 'Required') {
    return this.min(1, message);
  }
}

export class ZodNumber extends ZodType<number> {
  private minValue?: { value: number; inclusive: boolean; message: string };
  private maxValue?: { value: number; inclusive: boolean; message: string };
  private integer = false;

  protected _parse(input: unknown, ctx: ParseContext, path: ZodPath): number {
    if (typeof input !== 'number' || Number.isNaN(input)) {
      ctx.issues.push({ path, code: 'invalid_type', message: 'Expected number' });
      return 0;
    }
    if (this.integer && !Number.isInteger(input)) {
      ctx.issues.push({ path, code: 'invalid_type', message: 'Expected integer' });
    }
    if (this.minValue) {
      const { value, inclusive, message } = this.minValue;
      const comparison = inclusive ? input < value : input <= value;
      if (comparison) {
        ctx.issues.push({ path, code: 'too_small', message });
      }
    }
    if (this.maxValue) {
      const { value, inclusive, message } = this.maxValue;
      const comparison = inclusive ? input > value : input >= value;
      if (comparison) {
        ctx.issues.push({ path, code: 'too_big', message });
      }
    }
    this.runRefinements(input, ctx, path);
    return input;
  }

  min(value: number, message?: string) {
    this.minValue = { value, inclusive: true, message: message ?? `Should be >= ${value}` };
    return this;
  }

  max(value: number, message?: string) {
    this.maxValue = { value, inclusive: true, message: message ?? `Should be <= ${value}` };
    return this;
  }

  nonnegative(message?: string) {
    return this.min(0, message ?? 'Should be >= 0');
  }

  int(message?: string) {
    this.integer = true;
    if (message) {
      this.refine((v) => Number.isInteger(v), message);
    }
    return this;
  }
}

export class ZodBoolean extends ZodType<boolean> {
  protected _parse(input: unknown, ctx: ParseContext, path: ZodPath): boolean {
    if (typeof input !== 'boolean') {
      ctx.issues.push({ path, code: 'invalid_type', message: 'Expected boolean' });
      return false;
    }
    this.runRefinements(input, ctx, path);
    return input;
  }
}

export class ZodLiteral<T extends string | number | boolean> extends ZodType<T> {
  constructor(private value: T) {
    super();
  }

  protected _parse(input: unknown, ctx: ParseContext, path: ZodPath): T {
    if (input !== this.value) {
      ctx.issues.push({ path, code: 'invalid_literal', message: `Expected literal ${this.value}` });
    }
    this.runRefinements(this.value, ctx, path);
    return this.value;
  }

  get literal() {
    return this.value;
  }
}

export class ZodEnum<T extends [string, ...string[]]> extends ZodType<T[number]> {
  private optionSet: Set<string>;

  constructor(private values: T) {
    super();
    this.optionSet = new Set(values);
  }

  protected _parse(input: unknown, ctx: ParseContext, path: ZodPath): T[number] {
    if (typeof input !== 'string' || !this.optionSet.has(input)) {
      ctx.issues.push({ path, code: 'invalid_enum_value', message: `Expected one of ${this.values.join(', ')}` });
      return this.values[0];
    }
    const value = input as T[number];
    this.runRefinements(value, ctx, path);
    return value;
  }

  get optionsArray() {
    return this.values;
  }
}

export class ZodArray<T> extends ZodType<T[]> {
  private minLength?: { value: number; message: string };
  private maxLength?: { value: number; message: string };

  constructor(private element: ZodType<T>) {
    super();
  }

  protected _parse(input: unknown, ctx: ParseContext, path: ZodPath): T[] {
    if (!Array.isArray(input)) {
      ctx.issues.push({ path, code: 'invalid_type', message: 'Expected array' });
      return [];
    }
    if (this.minLength && input.length < this.minLength.value) {
      ctx.issues.push({ path, code: 'too_small', message: this.minLength.message });
    }
    if (this.maxLength && input.length > this.maxLength.value) {
      ctx.issues.push({ path, code: 'too_big', message: this.maxLength.message });
    }
    const result: T[] = [];
    input.forEach((item, index) => {
      const before = ctx.issues.length;
      const parsed = this.element._parse(item, ctx, [...path, index]);
      if (ctx.issues.length === before) {
        result.push(parsed);
      }
    });
    this.runRefinements(result, ctx, path);
    return result;
  }

  min(value: number, message?: string) {
    this.minLength = { value, message: message ?? `Should contain at least ${value} items` };
    return this;
  }

  max(value: number, message?: string) {
    this.maxLength = { value, message: message ?? `Should contain at most ${value} items` };
    return this;
  }

  unwrap() {
    return this.element;
  }
}

export type ZodRawShape = { [key: string]: ZodTypeAny };

export class ZodObject<Shape extends ZodRawShape> extends ZodType<{ [K in keyof Shape]: Shape[K]['_type'] }> {
  private catchallType?: ZodTypeAny;

  constructor(private shape: Shape) {
    super();
  }

  protected _parse(input: unknown, ctx: ParseContext, path: ZodPath): { [K in keyof Shape]: Shape[K]['_type'] } {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
      ctx.issues.push({ path, code: 'invalid_type', message: 'Expected object' });
      return {} as any;
    }
    const source = input as Record<string, unknown>;
    const result: Record<string, unknown> = {};

    for (const key of Object.keys(this.shape)) {
      const schema = this.shape[key];
      const before = ctx.issues.length;
      const parsed = schema._parse(source[key], ctx, [...path, key]);
      if (ctx.issues.length === before) {
        result[key] = parsed;
      }
    }

    if (this.catchallType) {
      for (const key of Object.keys(source)) {
        if (!(key in this.shape)) {
          const before = ctx.issues.length;
          const parsed = this.catchallType._parse(source[key], ctx, [...path, key]);
          if (ctx.issues.length === before) {
            result[key] = parsed;
          }
        }
      }
    } else {
      for (const key of Object.keys(source)) {
        if (!(key in this.shape)) {
          result[key] = source[key];
        }
      }
    }

    this.runRefinements(result as any, ctx, path);
    return result as any;
  }

  extend<NewShape extends ZodRawShape>(shape: NewShape): ZodObject<Shape & NewShape> {
    return new ZodObject({ ...(this.shape as any), ...shape });
  }

  catchall(type: ZodTypeAny): this {
    this.catchallType = type;
    return this;
  }

  partial(): ZodObject<{ [K in keyof Shape]: ZodOptional<Shape[K]['_type']> }> {
    const next: Record<string, ZodTypeAny> = {};
    for (const key of Object.keys(this.shape)) {
      next[key] = this.shape[key].optional();
    }
    return new ZodObject(next as any);
  }

  shapeKeys(): Shape {
    return this.shape;
  }
}

export class ZodOptional<T> extends ZodType<T | undefined> {
  constructor(private inner: ZodType<T>) {
    super();
  }

  protected _parse(input: unknown, ctx: ParseContext, path: ZodPath): T | undefined {
    if (input === undefined) {
      this.runRefinements(undefined as any, ctx, path);
      return undefined;
    }
    const value = this.inner._parse(input, ctx, path);
    this.runRefinements(value as any, ctx, path);
    return value;
  }

  unwrap() {
    return this.inner;
  }
}

export class ZodNullable<T> extends ZodType<T | null> {
  constructor(private inner: ZodType<T>) {
    super();
  }

  protected _parse(input: unknown, ctx: ParseContext, path: ZodPath): T | null {
    if (input === null) {
      this.runRefinements(null as any, ctx, path);
      return null;
    }
    const value = this.inner._parse(input, ctx, path);
    this.runRefinements(value as any, ctx, path);
    return value;
  }

  unwrap() {
    return this.inner;
  }
}

export class ZodDefault<T> extends ZodType<T> {
  constructor(private inner: ZodType<T>, private defaultValue: T | (() => T)) {
    super();
  }

  protected _parse(input: unknown, ctx: ParseContext, path: ZodPath): T {
    if (input === undefined) {
      const value = typeof this.defaultValue === 'function'
        ? (this.defaultValue as () => T)()
        : this.defaultValue;
      this.runRefinements(value, ctx, path);
      return value;
    }
    const value = this.inner._parse(input, ctx, path);
    this.runRefinements(value, ctx, path);
    return value;
  }

  unwrap() {
    return this.inner;
  }
}

export class ZodUnion<T extends [ZodTypeAny, ...ZodTypeAny[]]> extends ZodType<T[number]['_type']> {
  constructor(private options: T) {
    super();
  }

  protected _parse(input: unknown, ctx: ParseContext, path: ZodPath): any {
    for (const option of this.options) {
      const result = option.safeParse(input);
      if (result.success) {
        this.runRefinements(result.data, ctx, path);
        return result.data;
      }
    }
    ctx.issues.push({ path, code: 'invalid_union', message: 'Value does not match union schema' });
    return undefined;
  }

  get optionsList() {
    return this.options;
  }
}

export class ZodAny extends ZodType<any> {
  protected _parse(input: unknown): any {
    return input;
  }
}

export class ZodUnknown extends ZodType<unknown> {
  protected _parse(input: unknown): unknown {
    return input;
  }
}

export class ZodRecord extends ZodType<Record<string, unknown>> {
  constructor(private valueType: ZodTypeAny) {
    super();
  }

  protected _parse(input: unknown, ctx: ParseContext, path: ZodPath): Record<string, unknown> {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
      ctx.issues.push({ path, code: 'invalid_type', message: 'Expected record' });
      return {};
    }
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      const before = ctx.issues.length;
      const parsed = this.valueType._parse(value, ctx, [...path, key]);
      if (ctx.issues.length === before) {
        result[key] = parsed;
      }
    }
    return result;
  }

  unwrap() {
    return this.valueType;
  }
}

export class ZodLiteralUnion extends ZodType<string | number | boolean> {
  constructor(private literals: Array<string | number | boolean>) {
    super();
  }

  protected _parse(input: unknown, ctx: ParseContext, path: ZodPath): any {
    if (!this.literals.includes(input as any)) {
      ctx.issues.push({ path, code: 'invalid_literal', message: `Expected one of ${this.literals.join(', ')}` });
      return this.literals[0];
    }
    return input;
  }

  get values() {
    return this.literals;
  }
}

export type ZodTypeAny = ZodType<any>;

export type infer<T extends ZodTypeAny> = T['_type'];

export const z = {
  string: () => new ZodString(),
  number: () => new ZodNumber(),
  boolean: () => new ZodBoolean(),
  literal: <T extends string | number | boolean>(value: T) => new ZodLiteral(value),
  enum: <T extends [string, ...string[]]>(values: T) => new ZodEnum(values),
  object: <Shape extends ZodRawShape>(shape: Shape) => new ZodObject(shape),
  array: <T>(schema: ZodType<T>) => new ZodArray(schema),
  union: <T extends [ZodTypeAny, ...ZodTypeAny[]]>(schemas: T) => new ZodUnion(schemas),
  optional: <T>(schema: ZodType<T>) => new ZodOptional(schema),
  record: (schema: ZodTypeAny) => new ZodRecord(schema),
  any: () => new ZodAny(),
  unknown: () => new ZodUnknown(),
};

export default z;
