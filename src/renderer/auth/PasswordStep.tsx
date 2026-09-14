import { AuthStepForm } from './AuthStepForm'
import type { AuthStepProps } from './PhoneStep'

export function PasswordStep({ submitting, error, onSubmit }: AuthStepProps): React.JSX.Element {
  return (
    <AuthStepForm
      prompt="Введите пароль двухфакторной аутентификации"
      label="Пароль"
      inputType="password"
      autoComplete="current-password"
      submitting={submitting}
      error={error}
      onSubmit={onSubmit}
      clearOnSubmit
    />
  )
}
