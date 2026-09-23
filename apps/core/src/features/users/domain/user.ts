export type User = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image: string | null;
  companyId: string | null;
  createdAt: Date;
  updatedAt: Date;
};
