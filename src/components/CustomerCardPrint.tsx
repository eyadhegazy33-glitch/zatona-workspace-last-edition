import { createPortal } from "react-dom";
import type { Customer } from "../services/customers";
import { CustomerCard } from "./CustomerCard";

export type PrintableCustomerCard = {
  customer: Customer;
  qrDataUrl: string;
  studentTypeName: string;
};

export function CustomerCardPrint({ cards }: {
  cards: PrintableCustomerCard[];
  labels?: {
    qrCode?: string;
    expires?: string;
    noExpiry?: string;
  };
}) {
  if (cards.length === 0) return null;

  return createPortal(
    <section className="customer-print-area" id="customer-print-area">
      {cards.map(({ customer, qrDataUrl, studentTypeName }, pageIndex) => (
        <div className="customer-print-sheet" key={pageIndex}>
          <CustomerCard
            customer={{
              fullName: customer.full_name,
              studentType: studentTypeName,
              birthDate: formatDateOnly(customer.birth_date),
              code: customer.code,
            }}
            qrDataUrl={qrDataUrl}
          />
        </div>
      ))}
    </section>,
    document.body,
  );
}

function formatDateOnly(value: string): string {
  const [year, month, day] = value.slice(0, 10).split("-");
  return year && month && day ? `${day}/${month}/${year}` : value;
}
