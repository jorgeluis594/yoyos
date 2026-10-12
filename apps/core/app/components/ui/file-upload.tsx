import * as React from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type FileUploadContextValue = { open: () => void; disabled: boolean };
const FileUploadContext = React.createContext<FileUploadContextValue | null>(null);

function useFileUpload() {
  const context = React.useContext(FileUploadContext);
  if (!context) throw new Error("FileUpload parts must be used within FileUpload");
  return context;
}

/**
 * Single-file picker. The native input stays hidden; `FileUploadTrigger` or `FileUploadDropzone`
 * open it. Upload state, preview and errors are composed by the caller (`Alert`, `FileUploadPreview`).
 */
function FileUpload({ className, children, accept, name, disabled = false, onFileSelect, ...props }: React.ComponentProps<"div"> & {
  accept?: string;
  name?: string;
  disabled?: boolean;
  onFileSelect: (file: File) => void;
}) {
  const input = React.useRef<HTMLInputElement>(null);
  const context = React.useMemo(() => ({ open: () => input.current?.click(), disabled }), [disabled]);
  return (
    <FileUploadContext.Provider value={context}>
      <div data-slot="file-upload" data-disabled={disabled || undefined} className={cn("flex flex-col gap-3", className)} {...props}>
        <input
          ref={input}
          data-slot="file-upload-input"
          type="file"
          name={name}
          accept={accept}
          disabled={disabled}
          tabIndex={-1}
          aria-hidden="true"
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            // Reset so choosing the same file again (a retry) fires change.
            event.target.value = "";
            if (file) onFileSelect(file);
          }}
        />
        {children}
      </div>
    </FileUploadContext.Provider>
  );
}

function FileUploadTrigger({ onClick, disabled, variant = "outline", ...props }: React.ComponentProps<typeof Button>) {
  const context = useFileUpload();
  return (
    <Button
      data-slot="file-upload-trigger"
      type="button"
      variant={variant}
      disabled={disabled || context.disabled}
      onClick={(event) => { onClick?.(event); if (!event.defaultPrevented) context.open(); }}
      {...props}
    />
  );
}

/** Large dashed target for the main file of a step (e.g. a payment receipt). */
function FileUploadDropzone({ className, onClick, disabled, ...props }: React.ComponentProps<"button">) {
  const context = useFileUpload();
  return (
    <button
      data-slot="file-upload-dropzone"
      type="button"
      disabled={disabled || context.disabled}
      onClick={(event) => { onClick?.(event); if (!event.defaultPrevented) context.open(); }}
      className={cn(
        "flex min-h-24 w-full flex-col items-center justify-center gap-2 rounded-[var(--radius-card)] border border-dashed bg-card p-4 text-center text-sm font-medium outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive [&_svg:not([class*='size-'])]:size-5",
        className,
      )}
      {...props}
    />
  );
}

function FileUploadPreview({ className, alt, ...props }: React.ComponentProps<"img">) {
  return <img data-slot="file-upload-preview" alt={alt} className={cn("max-h-48 w-fit rounded-[var(--radius-control)] border border-border object-contain", className)} {...props} />;
}

function FileUploadActions({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="file-upload-actions" className={cn("flex flex-wrap items-center gap-3", className)} {...props} />;
}

export { FileUpload, FileUploadTrigger, FileUploadDropzone, FileUploadPreview, FileUploadActions };
