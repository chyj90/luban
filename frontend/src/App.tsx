import { RouterProvider } from 'react-router-dom';
import { router } from '@/router';
import { Toast } from '@/components/Toast';
import { ConfirmDialog } from '@/components/ConfirmDialog';

function App() {
  return (
    <>
      <RouterProvider router={router} />
      <Toast />
      <ConfirmDialog />
    </>
  );
}

export default App;