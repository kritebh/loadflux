import React from "react";
import Content from "@theme-original/DocItem/Content";
import type ContentType from "@theme/DocItem/Content";
import type { WrapperProps } from "@docusaurus/types";
import CopyPageButton from "@site/src/components/CopyPageButton";

type Props = WrapperProps<typeof ContentType>;

/**
 * Wraps the default doc content to render the "Copy page" button above it.
 * This is a safe swizzle wrapper — it renders the original Content untouched.
 */
export default function ContentWrapper(props: Props): React.JSX.Element {
  return (
    <>
      <CopyPageButton />
      <Content {...props} />
    </>
  );
}
