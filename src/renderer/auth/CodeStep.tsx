import { AuthStepForm } from './AuthStepForm'
import type { AuthStepProps } from './PhoneStep'

export function CodeStep({ submitting, error, onSubmit }: AuthStepProps): React.JSX.Element {
  return (
    <AuthStepForm
      prompt="Введите код подтверждения, отправленный в Telegram"
      label="Код подтверждения"
      inputType="text"
      autoComplete="one-time-code"
      placeholder="12345"
      submitting={submitting}
      error={error}
      onSubmit={onSubmit}
    />
  )
}
