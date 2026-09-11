/** Java LTS sürümleri — hedef upgrade seçimi için */
export const JAVA_LTS_VERSIONS = ['8', '11', '17', '21', '25'] as const;

export type JavaLtsVersion = (typeof JAVA_LTS_VERSIONS)[number];

export const DEFAULT_TARGET_JAVA: JavaLtsVersion = '21';
