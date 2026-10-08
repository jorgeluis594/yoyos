import { useId, useState } from "react";
import { Input } from "@core/app/components/ui/input";
import { controlClass } from "@core/app/components/ui/field";
import { getPeruDistrict, getPeruDistricts, getPeruProvinces, peruDepartments, type PeruDistrict, type PeruDistrictCode } from "@shared/peru-geography";

export function filterPeruDistricts(districts: readonly PeruDistrict[], query: string): readonly PeruDistrict[] {
  const normalize = (value: string) => value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("es").trim();
  const term = normalize(query);
  return districts.filter(district => normalize(district.name).includes(term) || district.code.includes(term));
}

export function PeruDistrictSelect({ value, onChange, disabled = false }: Readonly<{
  value: PeruDistrictCode | null; onChange: (value: PeruDistrictCode | null) => void; disabled?: boolean;
}>) {
  const id = useId();
  const selected = value ? getPeruDistrict(value) : null;
  const [departmentCode, setDepartmentCode] = useState<string>(selected?.departmentCode ?? "");
  const [provinceCode, setProvinceCode] = useState<string>(selected?.provinceCode ?? "");
  const [query, setQuery] = useState("");
  const department = peruDepartments.find(item => item.code === (selected?.departmentCode ?? departmentCode));
  const provinces = department ? getPeruProvinces(department.code) : [];
  const province = provinces.find(item => item.code === (selected?.provinceCode ?? provinceCode));
  const districts = province ? getPeruDistricts(province.code) : [];
  const matches = filterPeruDistricts(districts, query);
  const options = selected && !matches.some(item => item.code === selected.code) ? [selected, ...matches] : matches;
  return <fieldset disabled={disabled} className="flex min-w-0 flex-col gap-3">
    <legend className="mb-3 font-medium">Distrito de entrega</legend>
    <div className="grid min-w-0 gap-3 sm:grid-cols-2">
      <div className="flex min-w-0 flex-col gap-1.5"><label htmlFor={`${id}-department`} className="text-sm font-medium">Departamento</label>
        <select id={`${id}-department`} className={controlClass} value={department?.code ?? ""} onChange={event => {
          setDepartmentCode(event.target.value); setProvinceCode(""); setQuery(""); onChange(null);
        }}><option value="">Selecciona un departamento</option>{peruDepartments.map(item => <option key={item.code} value={item.code}>{item.name}</option>)}</select>
      </div>
      <div className="flex min-w-0 flex-col gap-1.5"><label htmlFor={`${id}-province`} className="text-sm font-medium">Provincia</label>
        <select id={`${id}-province`} className={controlClass} value={province?.code ?? ""} disabled={!department} onChange={event => {
          setProvinceCode(event.target.value); setQuery(""); onChange(null);
        }}><option value="">Selecciona una provincia</option>{provinces.map(item => <option key={item.code} value={item.code}>{item.name}</option>)}</select>
      </div>
    </div>
    <div className="flex flex-col gap-1.5"><label htmlFor={`${id}-search`} className="text-sm font-medium">Buscar distrito</label>
      <Input id={`${id}-search`} type="search" disabled={!province} value={query} onChange={event => setQuery(event.target.value)} placeholder="Nombre o código de distrito" />
    </div>
    <div className="flex flex-col gap-1.5"><label htmlFor={`${id}-district`} className="text-sm font-medium">Distrito</label>
      <select id={`${id}-district`} className={controlClass} value={value ?? ""} disabled={!province} aria-describedby={`${id}-hint`} onChange={event => {
        onChange(districts.find(item => item.code === event.target.value)?.code ?? null);
      }}><option value="">Selecciona un distrito</option>{options.map(item => <option key={item.code} value={item.code}>{item.name} · {item.code}</option>)}</select>
      <p id={`${id}-hint`} className="text-sm text-muted-foreground" role="status">{!province ? "Selecciona departamento y provincia para ver sus distritos." : matches.length === 0 ? "No hay distritos con esa búsqueda. Prueba otro nombre o código." : `${matches.length} distritos disponibles en ${province.name}.`}</p>
    </div>
  </fieldset>;
}
