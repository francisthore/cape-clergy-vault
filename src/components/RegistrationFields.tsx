import { Input } from "@/components/ui/input";
import { registrationNotice } from "@/lib/auth/registration";
export function Field({
  label,
  name,
  ...props
}: React.ComponentProps<typeof Input> & { label: string; name: string }) {
  return (
    <div>
      <label htmlFor={name} className="text-sm font-medium">
        {label}
      </label>
      <Input id={name} name={name} className="mt-1" required {...props} />
    </div>
  );
}
export function ProfileFields() {
  return (
    <>
      <Field name="title" label="Clergy title" maxLength={40} autoComplete="honorific-prefix" />
      <Field name="fullName" label="Full name" minLength={2} maxLength={120} autoComplete="name" />
      <Field
        name="parish"
        label="Parish or ministry"
        minLength={2}
        maxLength={120}
        autoComplete="organization"
      />
      <Field
        name="phone"
        label="Phone number (optional)"
        type="tel"
        maxLength={30}
        autoComplete="tel"
        required={false}
      />
    </>
  );
}
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
export function PrivacyAcknowledgement() {
  return (
    <div className="space-y-3 text-sm">
      <p className="rounded border bg-muted p-3">{registrationNotice.warning}</p>
      <Dialog>
        <DialogTrigger asChild>
          <button type="button" className="text-primary underline underline-offset-4">
            {registrationNotice.label}
          </button>
        </DialogTrigger>
        <DialogContent className="max-h-[85dvh] w-[calc(100%-2rem)] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{registrationNotice.label}</DialogTitle>
            <DialogDescription>{registrationNotice.warning}</DialogDescription>
          </DialogHeader>
          {registrationNotice.sections.map((section) => (
            <section key={section.heading} className="space-y-2 text-sm">
              <h3 className="font-semibold">{section.heading}</h3>
              <p>{section.text}</p>
            </section>
          ))}
          <p className="break-words text-xs text-muted-foreground">
            Acknowledgement reference: {registrationNotice.version}
          </p>
        </DialogContent>
      </Dialog>
      <label className="flex items-start gap-3">
        <input className="mt-1 h-4 w-4 shrink-0" type="checkbox" name="acknowledged" required />
        <span>I have read and acknowledge the Cape Clergy Vault Privacy Notice (Version 1).</span>
      </label>
    </div>
  );
}
