// AliExpress Open Platform / Dropshipping API — request & response shapes.
// Field names mirror the platform's actual (snake_case) JSON so mapping
// code can be verified against the real API docs/fixtures without a
// translation layer hiding mismatches.

export interface AliExpressCredentials {
  appKey: string;
  appSecret: string;
  accessToken: string;
  refreshToken: string;
}

export interface AliExpressSkuProperty {
  sku_property_id: number;
  property_value_id: number;
  property_value_definition_name: string;
}

export interface AliExpressSku {
  sku_id: string;
  sku_price: string; // supplier cost, decimal string in the account currency
  sku_available_stock: number;
  sku_code?: string;
  sku_properties?: AliExpressSkuProperty[];
  currency_code?: string;
}

export interface AliExpressProductDetail {
  product_id: string;
  subject: string; // raw supplier title, usually buzzword-laden
  detail?: string; // raw HTML description
  image_urls?: string; // "url1;url2;url3"
  category_id?: number;
  currency_code: string;
  ae_item_sku_info_dtos: AliExpressSku[];
  package_info?: {
    gross_weight?: string; // kg, decimal string
    product_unit?: string;
  };
}

export interface FreightQueryRequest {
  productId: string;
  skuId: string;
  quantity: number;
  countryCode: string; // ISO 3166-1 alpha-2 destination
}

export interface FreightOption {
  serviceName: string;
  shippingFee: string; // decimal string, account currency
  estimatedDeliveryDays: string; // e.g. "15-25"
  trackingAvailable: boolean;
}

export interface OrderAddress {
  contactPerson: string;
  fullName: string;
  address: string;
  address2?: string;
  city: string;
  province: string;
  zip: string;
  country: string; // ISO 3166-1 alpha-2
  phoneCountry?: string;
  mobileNo: string;
}

export interface CreateOrderLineItem {
  productId: string;
  skuId: string;
  quantity: number;
  logisticsServiceName: string;
}

export interface CreateOrderRequest {
  outOrderId: string; // our local order id — carried through to the supplier order, used for idempotency
  logisticsAddress: OrderAddress;
  items: CreateOrderLineItem[];
}

export interface CreateOrderResult {
  orderId: string;
  outOrderId: string;
}

export type AliExpressOrderStatus =
  | "PLACE_ORDER_SUCCESS"
  | "IN_CANCEL"
  | "WAIT_SELLER_SEND_GOODS"
  | "SELLER_PART_SEND_GOODS"
  | "WAIT_BUYER_ACCEPT_GOODS"
  | "FUND_PROCESSING"
  | "FINISH"
  | "IN_ISSUE"
  | "IN_FROZEN"
  | "WAIT_SELLER_EXAMINE_MONEY"
  | "RISK_CONTROL"
  | "IN_PRESELL_PROMOTION";

export interface AliExpressOrderDetail {
  order_id: string;
  order_status: AliExpressOrderStatus;
  logistics_status?: string;
  logistics_info_list?: Array<{
    logistics_no: string; // tracking number
    logistics_company: string; // carrier name
    tracking_url?: string;
  }>;
}

export interface TrackingQueryRequest {
  orderId: string;
  logisticsNo?: string;
}

export interface TrackingEvent {
  eventDate: string;
  eventDescription: string;
  location?: string;
}

export interface TrackingInfo {
  logisticsNo: string;
  logisticsCompany: string;
  status: string;
  events: TrackingEvent[];
}
