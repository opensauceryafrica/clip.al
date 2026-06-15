import { Text } from '@react-email/components';
import { EmailLayout } from '../components/Layout';
import { styles } from '../styles';

/**
 * Transactional receipt sent after a successful subscription charge (the
 * `charge.success` / Polar `order.paid` path). Plain monochrome, no marketing.
 *
 * `amountMinor` is in the currency subunit (kobo for NGN, cents for USD); we
 * format it to major units with two decimals. `periodEnd` is the date access is
 * paid through.
 */
export function SubscriptionReceipt({
  plan,
  amountMajor,
  currency,
  periodEndLabel,
}: {
  plan: string;
  amountMajor: string;
  currency: string;
  periodEndLabel: string;
}) {
  return (
    <EmailLayout preview={`Receipt for your clip.al ${plan} subscription`}>
      <Text style={styles.heading}>Payment received</Text>
      <Text style={styles.para}>
        Thanks — your clip.al subscription payment went through. Here are the details for
        your records.
      </Text>
      <div style={styles.codeBox}>
        <Text style={{ ...styles.para, margin: 0 }}>
          {currency} {amountMajor}
        </Text>
      </div>
      <Text style={styles.meta}>
        Plan: {plan}
        <br />
        Amount: {currency} {amountMajor}
        <br />
        Paid through: {periodEndLabel}
      </Text>
      <Text style={styles.para}>
        Your features are active immediately. You can manage or cancel your plan any time
        from your billing settings.
      </Text>
    </EmailLayout>
  );
}
