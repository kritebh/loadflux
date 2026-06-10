import ThemedImage from "@theme/ThemedImage";
import useBaseUrl from "@docusaurus/useBaseUrl";

export default function Screenshot({
  name,
  alt,
}: {
  name: string;
  alt: string;
}) {
  return (
    <ThemedImage
      alt={alt}
      sources={{
        light: useBaseUrl(`/img/screenshots/${name}-light.png`),
        dark: useBaseUrl(`/img/screenshots/${name}-dark.png`),
      }}
    />
  );
}
