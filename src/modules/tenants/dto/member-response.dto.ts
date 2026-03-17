export class MemberResponseDto {
  id: string;
  userId: string;
  email: string;
  name: string;
  picture: string | null;
  role: string;
  joinedAt: Date;

  constructor(member: {
    id: string;
    userId: string;
    role: string;
    createdAt: Date;
    user: { email: string; name: string; picture: string | null };
  }) {
    this.id = member.id;
    this.userId = member.userId;
    this.email = member.user.email;
    this.name = member.user.name;
    this.picture = member.user.picture;
    this.role = member.role;
    this.joinedAt = member.createdAt;
  }
}
