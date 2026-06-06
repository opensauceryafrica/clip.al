import { Text } from '@react-email/components';
import { EmailLayout } from '../components/Layout';
import { styles } from '../styles';

export function LinkDisabled({
  code,
  destination,
  threats,
}: {
  code: string;
  destination: string;
  threats: string[];
}) {
  return (
    <EmailLayout preview="A clip.al link of yours was disabled for safety">
      <Text style={styles.heading}>A link was disabled for safety</Text>
      <Text style={styles.para}>
        Our rolling safety re-scan flagged the destination of one of your links, so we
        disabled it to protect people who click it.
      </Text>
      <Text style={styles.meta}>
        Short code: clip.al/{code}
        <br />
        Destination: {destination}
        {threats.length > 0 ? (
          <>
            <br />
            Flagged as: {threats.join(', ')}
          </>
        ) : null}
      </Text>
      <Text style={styles.para}>
        If you think this is wrong, reply to your report or contact support and we’ll
        re-review it.
      </Text>
    </EmailLayout>
  );
}
