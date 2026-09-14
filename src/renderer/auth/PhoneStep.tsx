import { AuthStepForm } from './AuthStepForm'

export interface AuthStepProps {
  submitting: boolean
  error: string | null
  onSubmit: (value: string) => void
}

export function PhoneStep({ submitting, error, onSubmit }: AuthStepProps): React.JSX.Element {
  return (
    <AuthStepForm
      prompt="Введите номер телефона в международном формате"
      label="Номер телефона"
      inputType="tel"
      autoComplete="tel"
      placeholder="+1234567890"
      submitting={submitting}
      error={error}
      onSubmit={onSubmit}
    />
  )
}
