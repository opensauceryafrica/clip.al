import { Text } from '@react-email/components';
import { EmailLayout } from '../components/Layout';
import { styles } from '../styles';

export function AccountSuspended({
  reason,
  contactUrl,
}: {
  reason?: string | undefined;
  contactUrl: string;
}) {
  return (
    <EmailLayout preview="Your clip.al account has been suspended">
      <Text style={styles.heading}>Your account has been suspended</Text>
      <Text style={styles.para}>
        A clip.al moderator has suspended your account. Your links no longer redirect
        while the suspension is in place.
      </Text>
      {reason ? <Text style={styles.meta}>Reason: {reason}</Text> : null}
      <Text style={styles.para}>
        If you believe this was a mistake, you can appeal here: {contactUrl}
      </Text>
    </EmailLayout>
  );
}
