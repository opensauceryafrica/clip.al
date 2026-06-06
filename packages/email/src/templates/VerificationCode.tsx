import { Section, Text } from '@react-email/components';
import { EmailLayout } from '../components/Layout';
import { styles } from '../styles';

export function VerificationCode({
  code,
  city,
  ip,
  expiresMinutes = 10,
}: {
  code: string;
  city?: string | undefined;
  ip?: string | undefined;
  expiresMinutes?: number;
}) {
  const location = city ? city : 'an unrecognized location';
  return (
    <EmailLayout preview={`Your clip.al code: ${code}`}>
      <Text style={styles.heading}>Your sign-in code</Text>
      <Text style={styles.para}>
        Enter this code to continue. It expires in {expiresMinutes} minutes.
      </Text>
      <Section style={styles.codeBox}>
        <Text style={styles.code}>{code}</Text>
      </Section>
      <Text style={styles.meta}>
        Requested from {location}
        {ip ? ` · ${ip}` : ''}.
      </Text>
      <Text style={styles.para}>Didn’t request this? You can safely ignore this email.</Text>
    </EmailLayout>
  );
}
