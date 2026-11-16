import type { PropSpec } from "@ui-sdk/core";

type Options = Record<string, PropSpec>;

const declaresOptions = <Declared extends { options?: Options | undefined }>(
  primitive: Declared,
): primitive is Declared & { options: Options } =>
  primitive.options !== undefined;

/** A ui-sdk primitive as its adapters ask for it. A primitive types `options` as present or undefined, which `exactOptionalPropertyTypes` refuses; each one carries them, and one that does not fails here at load. */
export const withOptions = <Declared extends { options?: Options | undefined }>(
  primitive: Declared,
): Declared & { options: Options } => {
  if (!declaresOptions(primitive))
    throw new Error("A ui-sdk primitive declares no options");

  return primitive;
};
