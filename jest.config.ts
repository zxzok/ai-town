import type { JestConfigWithTsJest } from 'ts-jest';

const jestConfig: JestConfigWithTsJest = {
  preset: 'ts-jest/presets/default-esm',
  moduleNameMapper: {
    '^zod$': '<rootDir>/vendor/zod/index.ts',
    '^zod-to-json-schema$': '<rootDir>/vendor/zod-to-json-schema/index.ts',
  },
};
export default jestConfig;
