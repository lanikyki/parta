import { fail } from '@/lib/http';

// Неизвестный адрес API — понятная ошибка в JSON вместо HTML-страницы 404
const nope = async () => fail('Такого адреса нет', 404);
export const GET = nope;
export const POST = nope;
export const PUT = nope;
export const PATCH = nope;
export const DELETE = nope;
