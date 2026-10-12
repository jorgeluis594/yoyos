import type { Meta, StoryObj } from "@storybook/react-vite";
import { Upload } from "lucide-react";
import { Alert, AlertAction, AlertDescription } from "./alert";
import { Button } from "./button";
import { FileUpload, FileUploadActions, FileUploadDropzone, FileUploadPreview, FileUploadTrigger } from "./file-upload";

const meta = { title: "Design System/Components/FileUpload", component: FileUpload } satisfies Meta<typeof FileUpload>;
export default meta;
type Story = StoryObj<typeof meta>;

const preview = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='120'><rect width='160' height='120' fill='%23e5e7eb'/></svg>";

export const WithPreview: Story = {
  name: "Con vista previa",
  args: { accept: "image/jpeg,image/png,image/webp", onFileSelect: () => undefined },
  render: (args) => (
    <FileUpload {...args} className="max-w-form">
      <FileUploadPreview src={preview} alt="Vista previa de la foto" />
      <FileUploadActions>
        <FileUploadTrigger><Upload data-icon="inline-start" aria-hidden="true" />Cambiar foto</FileUploadTrigger>
        <Button type="button" variant="ghost">Quitar</Button>
      </FileUploadActions>
    </FileUpload>
  ),
};

export const Uploading: Story = {
  name: "Subiendo",
  args: { disabled: true, onFileSelect: () => undefined },
  render: (args) => (
    <FileUpload {...args} className="max-w-form">
      <FileUploadActions><FileUploadTrigger>Subir foto</FileUploadTrigger></FileUploadActions>
      <Alert>Subiendo imagen…</Alert>
    </FileUpload>
  ),
};

export const DropzoneWithError: Story = {
  name: "Zona con error",
  args: { accept: "image/*", onFileSelect: () => undefined },
  render: (args) => (
    <FileUpload {...args} className="max-w-form">
      <FileUploadDropzone aria-invalid="true"><Upload className="text-primary" aria-hidden="true" />Captura del pago<span className="text-xs font-normal text-muted-foreground">comprobante.png</span></FileUploadDropzone>
      <Alert variant="destructive">
        <AlertDescription>No se pudo subir la imagen.</AlertDescription>
        <AlertAction><Button size="sm" variant="outline">Reintentar</Button></AlertAction>
      </Alert>
    </FileUpload>
  ),
};
