import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { DescriptionDetails, DescriptionItem, DescriptionList, DescriptionTerm } from "@/components/ui/description-list";

test("keeps each term and value inside a valid dl row", () => {
  const html = renderToStaticMarkup(
    <DescriptionList orientation="vertical">
      <DescriptionItem><DescriptionTerm>Banco</DescriptionTerm><DescriptionDetails>BCP</DescriptionDetails></DescriptionItem>
    </DescriptionList>,
  );
  expect(html).toMatch(/^<dl[^>]*data-orientation="vertical"[^>]*><div[^>]*><dt[^>]*>Banco<\/dt><dd[^>]*>BCP<\/dd><\/div><\/dl>$/);
});
