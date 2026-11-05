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
export function PrivacyAcknowledgement() {
  return (
    <>
      <section
        aria-label="Registration privacy notice"
        className="rounded border bg-muted p-4 text-sm"
      >
        <p className="font-semibold">{registrationNotice.label}</p>
        <p>Version: {registrationNotice.version}</p>
        <ul className="mt-2 list-disc space-y-2 pl-5">
          {registrationNotice.points.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
        <p className="mt-3">
          This acknowledgement covers repository processing. Private chat consent is separate. Do
          not enter real personal or confidential information in this local test application.
        </p>
      </section>
      <label className="flex items-start gap-3 text-sm">
        <input className="mt-1" type="checkbox" name="acknowledged" required />
        <span>
          I have read the displayed draft notice and explicitly acknowledge processing for this
          local registration test.
        </span>
      </label>
    </>
  );
}
