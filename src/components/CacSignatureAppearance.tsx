import { SignatureGraphicPicker } from './SignatureGraphicPicker';

type Props = {
  width: number;
  height: number;
  value?: string;
  onChange(value: string | undefined): void;
  onBusyChange(busy: boolean): void;
};

export function CacSignatureAppearance({ width, height, value, onChange, onBusyChange }: Props) {
  return <details className="space-y-2 text-sm">
    <summary>Signature appearance</summary>
    <SignatureGraphicPicker value={value} onChange={onChange} onBusyChange={onBusyChange} />
    {value ? <>
      <div className="max-w-full overflow-x-auto">
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="box-content border bg-white"
          role="img" aria-label="Handwriting preview in the selected signature field">
          <image href={`data:image/png;base64,${value}`} x={1} y={1} width={Math.max(0, width / 2 - 1)}
            height={Math.max(0, height - 2)} preserveAspectRatio="xMidYMid meet" />
        </svg>
      </div>
      <p className="text-muted-foreground">Your certificate name and signing time will appear beside your handwriting.</p>
    </> : <p className="text-muted-foreground">Default appearance uses your certificate name and signing time.</p>}
  </details>;
}
