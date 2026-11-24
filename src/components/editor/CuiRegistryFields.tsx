import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CUI_PROVISIONAL_CATEGORIES, CUI_REGISTRY_CATEGORIES } from '@/data/cuiRegistry';
import { CUI_CATEGORY_REGISTRY, CUI_DISSEMINATION_REGISTRY, CUI_FIXED_CONTROLS, inspectCuiRegistryMarkings } from '@/lib/cuiRegistryMarkings';
import type { DocumentData } from '@/types/document';

type Field = 'cuiCategory' | 'cuiDissemination';
type Values = Partial<Pick<DocumentData, Field>>;

export function CuiRegistryFields({ categoryId, controlId, values, onChange, errors, suggestions = true }: {
  categoryId: string;
  controlId: string;
  values: Values;
  onChange: (field: Field, value: string) => void;
  errors?: Partial<Record<Field, string>>;
  suggestions?: boolean;
}) {
  const { issues } = inspectCuiRegistryMarkings(values);
  const categoryError = issues.find(issue => issue.field === 'cuiCategory')?.message ?? errors?.cuiCategory;
  const controlError = issues.find(issue => issue.field === 'cuiDissemination')?.message ?? errors?.cuiDissemination;
  return <>
    <div className="space-y-2">
      <Label htmlFor={categoryId}>CUI categories</Label>
      <Input id={categoryId} value={values.cuiCategory ?? ''} maxLength={240}
        placeholder="e.g., PRVCY, CTI" list={suggestions ? `${categoryId}-registry` : undefined}
        aria-invalid={!!categoryError} aria-describedby={`${categoryId}-help`}
        onChange={event => onChange('cuiCategory', event.target.value)} />
      {suggestions && <datalist id={`${categoryId}-registry`}>
        {CUI_REGISTRY_CATEGORIES.map(([marking, name]) => <option key={marking} value={marking}>{name}</option>)}
        {CUI_PROVISIONAL_CATEGORIES.map(name => <option key={name} value={name} />)}
      </datalist>}
      <p id={`${categoryId}-help`} className={categoryError ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}>
        {categoryError || 'Enter registry category names or markings, separated by commas.'}{' '}
        <a className="underline" href={CUI_CATEGORY_REGISTRY} target="_blank" rel="noreferrer">CUI Registry</a>
      </p>
    </div>
    <div className="space-y-2">
      <Label htmlFor={controlId}>Dissemination controls</Label>
      <Input id={controlId} value={values.cuiDissemination ?? ''} maxLength={240}
        placeholder="e.g., FEDCON" list={suggestions ? `${controlId}-registry` : undefined}
        aria-invalid={!!controlError} aria-describedby={`${controlId}-help`}
        onChange={event => onChange('cuiDissemination', event.target.value)} />
      {suggestions && <datalist id={`${controlId}-registry`}>{CUI_FIXED_CONTROLS.map(marking => <option key={marking} value={marking} />)}</datalist>}
      <p id={`${controlId}-help`} className={controlError ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}>
        {controlError || 'Use the controls authorized by the designating agency.'}{' '}
        <a className="underline" href={CUI_DISSEMINATION_REGISTRY} target="_blank" rel="noreferrer">Registry controls</a>
      </p>
    </div>
  </>;
}
