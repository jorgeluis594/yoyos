import { Input, type InputProps } from './input';

export type TextareaProps = InputProps;

export function Textarea({ style, ...props }: TextareaProps) {
  return <Input {...props} multiline textAlignVertical="top" style={[{ minHeight: 112 }, style]} />;
}
