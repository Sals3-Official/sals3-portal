type FieldErrorProps = {
  id: string;
  message?: string;
};

export default function FieldError({ id, message }: FieldErrorProps) {
  if (message === undefined || message === '') return null;

  return (
    <p id={id} className="text-xs leading-5 text-destructive">
      {message}
    </p>
  );
}
