import { useTranslation } from "react-i18next";
import { Button } from "@core/app/components/ui/button";
import { Field, FieldLabel, controlClass } from "@core/app/components/ui/field";
import { buyerAgencyLabel, chosenAgency, type AgencyChoices } from "@core/app/checkout-agency-choices";
import type { Money } from "@shared/money";

const status = "rounded-[var(--radius-control)] bg-muted p-4 text-sm text-muted-foreground";

export function CheckoutAgencyDestination({ choices, buyerDistrict, value, onChange, homeOffered, onChangeDistrict, onSwitchToHome, amount, disabled = false }: Readonly<{
  choices: AgencyChoices; buyerDistrict: Readonly<{ district: string; province: string; department: string }>;
  value: string; onChange: (agencyId: string) => void; homeOffered: boolean;
  onChangeDistrict: () => void; onSwitchToHome: () => void; amount: (price: Money) => string; disabled?: boolean;
}>) {
  const { t } = useTranslation();
  if (choices.level === "none") return <div role="status" className={`${status} flex flex-col items-start gap-3`}>
    <p>{t("checkoutDelivery.noAgencies", buyerDistrict)}</p>
    <div className="flex flex-wrap gap-2">
      <Button type="button" variant="outline" disabled={disabled} onClick={onChangeDistrict}>{t("checkoutDelivery.changeDistrict")}</Button>
      {homeOffered && <Button type="button" variant="outline" disabled={disabled} onClick={onSwitchToHome}>{t("checkoutDelivery.switchToHome")}</Button>}
    </div>
  </div>;
  const notice = choices.level === "province" ? "agenciesInProvince" : choices.level === "department" ? "agenciesInDepartment" : null;
  const selected = chosenAgency(choices, value)?.agency.id ?? "";
  return <>
    {notice && <p role="status" className={status}>{t(`checkoutDelivery.${notice}`, buyerDistrict)}</p>}
    <Field><FieldLabel htmlFor="delivery-agency">{t("checkoutDelivery.agency")}</FieldLabel>
      <select id="delivery-agency" data-slot="select" className={controlClass} value={selected} disabled={disabled} onChange={event => onChange(event.target.value)}>
        <option value="">{t("checkoutDelivery.selectAgency")}</option>
        {choices.choices.map(choice => <option key={choice.agency.id} value={choice.agency.id}>{buyerAgencyLabel(choice, amount)}</option>)}
      </select></Field>
  </>;
}
