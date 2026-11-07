import type {
  BlocksFieldDescription,
  BooleanFieldDescription,
  CollectionDescription,
  DateFieldDescription,
  FieldDescription,
  JsonFieldDescription,
  ListFieldDescription,
  NumberFieldDescription,
  ObjectFieldDescription,
  PointFieldDescription,
  TextFieldDescription,
} from "./contract.ts";
import type { CompiledField, FieldEntries } from "./fields.ts";

function describeEntries(fields: FieldEntries): Record<string, FieldDescription> {
  return Object.fromEntries(fields.map(([name, field]) => [name, describeField(field)]));
}

/** The compiled default, typed as the description's default. compileField has already validated it against this field's rules, which its `unknown` type cannot carry. */
function defaultOf<Described extends { default?: unknown }>(
  field: CompiledField,
): Pick<Described, "default"> {
  return field.hasDefault
    ? ({ default: structuredClone(field.default) } as Pick<Described, "default">)
    : {};
}

function describeRequired(field: CompiledField): FieldDescription {
  return { ...describeField(field), required: true };
}

/** Builds fresh plain data for one compiled field, so callers can never reach compiled state. */
export function describeField(field: CompiledField): FieldDescription {
  const presence = {
    required: !field.optional && !field.hasDefault,
    nullable: field.nullable,
  };
  const { rules } = field;
  switch (rules.kind) {
    case "text":
      return {
        type: "text",
        ...presence,
        unique: rules.unique,
        ...(rules.min === undefined ? {} : { min: rules.min }),
        ...(rules.max === undefined ? {} : { max: rules.max }),
        ...(rules.format === undefined ? {} : { format: rules.format }),
        ...(rules.choices === undefined ? {} : { choices: [...rules.choices] }),
        ...defaultOf<TextFieldDescription>(field),
        ...(rules.editor === undefined ? {} : { editor: { ...rules.editor } }),
      };
    case "number":
      return {
        type: "number",
        ...presence,
        integer: rules.integer,
        ...(rules.min === undefined ? {} : { min: rules.min }),
        ...(rules.max === undefined ? {} : { max: rules.max }),
        ...defaultOf<NumberFieldDescription>(field),
      };
    case "boolean":
      return {
        type: "boolean",
        ...presence,
        ...defaultOf<BooleanFieldDescription>(field),
        ...(rules.editor === undefined ? {} : { editor: { type: rules.editor } }),
      };
    case "date":
    case "datetime":
      return {
        type: rules.kind,
        ...presence,
        ...(rules.min === undefined ? {} : { min: rules.min }),
        ...(rules.max === undefined ? {} : { max: rules.max }),
        ...defaultOf<DateFieldDescription>(field),
      };
    case "list":
      return {
        type: "list",
        ...presence,
        item: describeRequired(rules.item),
        ...(rules.min === undefined ? {} : { min: rules.min }),
        ...(rules.max === undefined ? {} : { max: rules.max }),
        ...defaultOf<ListFieldDescription>(field),
      };
    case "object":
      return {
        type: "object",
        ...presence,
        fields: describeEntries(rules.fields),
        ...defaultOf<ObjectFieldDescription>(field),
      };
    case "blocks":
      return {
        type: "blocks",
        ...presence,
        variants: Object.fromEntries(
          rules.variants.map(([name, fields]): [string, ObjectFieldDescription] => [
            name,
            { type: "object", required: true, nullable: false, fields: describeEntries(fields) },
          ]),
        ),
        ...(rules.min === undefined ? {} : { min: rules.min }),
        ...(rules.max === undefined ? {} : { max: rules.max }),
        ...defaultOf<BlocksFieldDescription>(field),
      };
    case "json":
      return { type: "json", ...presence, ...defaultOf<JsonFieldDescription>(field) };
    case "point":
      return { type: "point", ...presence, ...defaultOf<PointFieldDescription>(field) };
    case "reference":
      return {
        type: "reference",
        ...presence,
        ...(rules.collections === undefined
          ? { collection: rules.collection! }
          : { collections: [...rules.collections] }),
      };
  }
}

export function describeCollection(fields: FieldEntries): CollectionDescription {
  return { fields: describeEntries(fields) };
}
