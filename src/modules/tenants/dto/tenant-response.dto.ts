export class TenantResponseDto {
  id: string;
  name: string;
  createdAt: Date;

  constructor(tenant: { id: string; name: string; createdAt: Date }) {
    this.id = tenant.id;
    this.name = tenant.name;
    this.createdAt = tenant.createdAt;
  }
}

export class TenantWithRoleDto {
  id: string;
  name: string;
  role: string;

  constructor(data: { id: string; name: string; role: string }) {
    this.id = data.id;
    this.name = data.name;
    this.role = data.role;
  }
}
