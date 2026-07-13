export type Business = {
  id: string;
  name: string;
  category: string;
  address: string;
  city: string;
  state: string;
  lat: number;
  lng: number;
  vestimate: number | null;
  annualRevenue: number | null;
  employees: number | null;
  founded: number | null;
  sqft: number | null;
  description: string;
  qualificationStatus: string | null;
  reviewCount: number | null;
};
