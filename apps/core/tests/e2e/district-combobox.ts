import type { Page } from "@playwright/test";
import { getPeruDepartment, getPeruDistrict, getPeruProvince } from "@shared/peru-geography";
import { provinceLabel, titleCase } from "@core/app/components/zone-entries";
import { browserExpect } from "@core/tests/e2e/fixtures";

function names(districtCode: string) {
  const district = getPeruDistrict(districtCode);
  const province = district && getPeruProvince(district.provinceCode);
  const department = district && getPeruDepartment(district.departmentCode);
  if (!district || !province || !department) throw new Error(`Unknown district ${districtCode}`);
  return { department: titleCase(department.name), province: provinceLabel(province.code, province.name), district: titleCase(district.name) };
}

async function choose(page: Page, label: string, name: string) {
  const input = page.getByRole("combobox", { name: label, exact: true });
  await input.click();
  await input.fill(name);
  await page.getByRole("option", { name, exact: true }).click();
}

/** Drives the three comboboxes of the district select by typing names, as a person does; the ubigeo is never typed or shown. */
export async function chooseDistrict(page: Page, districtCode: string) {
  const { department, province, district } = names(districtCode);
  await choose(page, "Departamento", department);
  await choose(page, "Provincia", province);
  await choose(page, "Distrito", district);
}

/** Changes only the district, keeping department and province. */
export async function chooseDistrictInProvince(page: Page, districtCode: string) {
  await choose(page, "Distrito", names(districtCode).district);
}

export async function expectDistrict(page: Page, districtCode: string) {
  await browserExpect(page.getByRole("combobox", { name: "Distrito", exact: true })).toHaveValue(names(districtCode).district);
}
