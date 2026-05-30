# v1.30 - Negative products and refund documents

- Products can now have negative sale prices, including negative price with VAT and negative price without VAT.
- Cashier totals can go below zero; the payment dialog supports confirming a negative receipt/refund document.
- Cash refunds show a refund amount instead of requiring cash received from the customer.
- Receipt printing labels negative documents as a refund/negative document.
- VAT breakdown keeps negative bases and negative VAT amounts for negative line items.
- Negative-price items added to a sale increase stock instead of decreasing it, useful for returned bottles/jars.
- Cash register expected cash is reduced by negative cash documents.
