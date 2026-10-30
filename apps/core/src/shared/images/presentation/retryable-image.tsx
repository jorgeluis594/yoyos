import { useState } from "react";
import { Button } from "@core/app/components/ui/button";

type Props = Readonly<{ url: string; alt: string; className: string; failedText: string; retryText: string }>;

/** A large image for a viewer; when it cannot load it says so and offers a retry. */
export function RetryableImage({ url, alt, className, failedText, retryText }: Props) {
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  if (failed) return <div role="alert" className="flex flex-col items-center gap-2 rounded-lg border p-4 text-sm">{failedText}
    <Button type="button" variant="outline" onClick={() => { setFailed(false); setAttempt(attempt + 1); }}>{retryText}</Button></div>;
  return <img key={attempt} src={url} alt={alt} loading="eager" onError={() => setFailed(true)} className={`mx-auto w-auto max-w-full rounded-md object-contain ${className}`} />;
}
