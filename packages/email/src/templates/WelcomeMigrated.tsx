import { Text } from '@react-email/components';
import { EmailLayout } from '../components/Layout';
import { styles } from '../styles';

export function WelcomeMigrated({ dashboardUrl }: { dashboardUrl: string }) {
  return (
    <EmailLayout preview="Welcome back to clip.al">
      <Text style={styles.heading}>Welcome back</Text>
      <Text style={styles.para}>
        Your clip.al account is set up. We recognized your email from abbrefy, so
        signing in was all it took — no new signup needed.
      </Text>
      <Text style={styles.para}>
        Your old abbrefy short links did not migrate; you can recreate any you still
        need. Everything else is new: a redirect path built for billions of clicks,
        URL safety scanning at submission and on a rolling basis, and real analytics.
      </Text>
      <Text style={styles.para}>
        Pick up where you left off: {dashboardUrl}
      </Text>
    </EmailLayout>
  );
}
